package com.example.orders.order.domain;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Orders by id, by owner and — for administrators — across all owners. */
public interface OrderRepository extends JpaRepository<Order, UUID> {

    /**
     * @param id order id
     * @return the order with its lines already loaded, so the response can be built outside the
     *         session ({@code open-in-view} is off)
     */
    @EntityGraph(attributePaths = "items")
    Optional<Order> findWithItemsById(UUID id);

    /**
     * The idempotent-replay lookup. Scoped by user on purpose: an {@code Idempotency-Key} is the
     * client's own bookkeeping, so two customers may pick the same string without colliding.
     *
     * @param userId         owner
     * @param idempotencyKey key the client sent
     * @return the order that key already produced, if any
     */
    @EntityGraph(attributePaths = "items")
    Optional<Order> findByUserIdAndIdempotencyKey(UUID userId, String idempotencyKey);

    // The paged finders deliberately do NOT join-fetch the lines: a collection fetch plus
    // LIMIT/OFFSET forces Hibernate to paginate in memory. The lines are loaded in batches
    // (hibernate.default_batch_fetch_size) while the read-only transaction is still open.

    /**
     * @param userId   owner
     * @param pageable page and sort
     * @return that user's orders
     */
    Page<Order> findByUserId(UUID userId, Pageable pageable);

    /**
     * @param status   status to filter on
     * @param pageable page and sort
     * @return all orders in that status, regardless of owner
     */
    Page<Order> findByStatus(OrderStatus status, Pageable pageable);

    /**
     * Every order in the given states whose last transition is older than the deadline, whatever
     * its refund is doing. <b>Not the saga-timeout sweeper's query</b>: an order that is only
     * waiting for its refund is not stuck, and its retries are paced by {@code refund_retry_at},
     * not by {@code updated_at} — the sweeper uses
     * {@link #findTop50ByStatusInAndRefundStatusNotAndUpdatedAtBeforeOrderByUpdatedAtAsc}, which
     * leaves those rows out so they cannot fill its capped batch.
     *
     * @param statuses non-final states to look at, i.e. {@link OrderStatus#UNFINISHED}
     * @param cutoff   the deadline; rows last touched before it are considered stuck
     * @return at most 50 orders, the longest-untouched first
     */
    List<Order> findTop50ByStatusInAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            Collection<OrderStatus> statuses, OffsetDateTime cutoff);

    /**
     * The saga-timeout sweeper's query: orders whose last transition is older than the deadline,
     * that the saga has still not finished and that are <em>not</em> waiting for a refund. Capped,
     * so one sweep cannot try to compensate a backlog of thousands of orders inside one scheduler
     * tick.
     *
     * <p>The refund exclusion is part of the query, not a skip in the sweeper's loop, on purpose: a
     * {@code CANCELLATION_PENDING} order with a {@code REQUESTED} refund is owned by the
     * refund-recovery query below, whose due check ({@code refund_retry_at}) is the only thing that
     * may pace its retries. Left in this scan, such rows would age past the order timeout, sort to
     * the front of a 50-row batch (their {@code updated_at} is older than a genuinely stuck order's)
     * and starve exactly the orders this scan exists for.
     *
     * @param statuses       non-final states to look at, i.e. {@link OrderStatus#UNFINISHED}
     * @param excludedRefund refund state whose orders belong to the recovery scan, i.e.
     *                       {@link RefundStatus#REQUESTED}
     * @param cutoff         the deadline; rows last touched before it are considered stuck
     * @return at most 50 stuck orders, the longest-stuck first
     */
    List<Order> findTop50ByStatusInAndRefundStatusNotAndUpdatedAtBeforeOrderByUpdatedAtAsc(
            Collection<OrderStatus> statuses, RefundStatus excludedRefund, OffsetDateTime cutoff);

    /**
     * The saga-timeout sweeper's query for orders that are <em>not</em> waiting at a hosted
     * checkout: like {@link #findTop50ByStatusInAndRefundStatusNotAndUpdatedAtBeforeOrderByUpdatedAtAsc},
     * but an order whose customer has a payment link open (stock held, {@code payment_url} set) is
     * left out — it is not stuck, it is waiting for a person, and has its own, longer window
     * ({@link #findAwaitingCustomerPastWindow}). Excluded in the query so such rows cannot fill the
     * capped batch and starve genuinely stuck orders.
     */
    @Query("""
            select o from OrderAggregate o
             where o.status in :statuses
               and o.refundStatus <> :excludedRefund
               and o.updatedAt < :cutoff
               and not (o.paymentUrl is not null and o.status in :awaitingStates)
             order by o.updatedAt asc
            """)
    List<Order> findStuckExcludingAwaitingCustomer(
            @Param("statuses") Collection<OrderStatus> statuses,
            @Param("excludedRefund") RefundStatus excludedRefund,
            @Param("awaitingStates") Collection<OrderStatus> awaitingStates,
            @Param("cutoff") OffsetDateTime cutoff,
            Pageable limit);

    /**
     * Orders whose customer was handed a hosted checkout ({@code payment_url} set, stock still
     * held) and did not finish paying in time. Two clocks make "in time": the configured payment
     * window, measured from the checkout's arrival (the last transition), and the provider's own
     * session deadline ({@code checkout_expires_at}) — a checkout Stripe itself no longer accepts
     * is compensated even when the window would keep waiting. Orders waiting for a refund are
     * excluded as above.
     */
    @Query("""
            select o from OrderAggregate o
             where o.status in :awaitingStates
               and o.paymentUrl is not null
               and o.refundStatus <> :excludedRefund
               and (o.updatedAt < :cutoff
                    or (o.checkoutExpiresAt is not null and o.checkoutExpiresAt < :now))
             order by o.updatedAt asc
            """)
    List<Order> findAwaitingCustomerPastWindow(
            @Param("awaitingStates") Collection<OrderStatus> awaitingStates,
            @Param("excludedRefund") RefundStatus excludedRefund,
            @Param("cutoff") OffsetDateTime cutoff,
            @Param("now") OffsetDateTime now,
            Pageable limit);

    /**
     * The refund-recovery sweep's query: orders the saga still owes a refund for, from a state in
     * which the payout is the only thing left ({@code CANCELLED} with a tracked payment, or an
     * in-flight {@code CANCELLATION_PENDING}). A refund is due for re-commanding when it has not
     * been re-queued within the retry interval — {@code refund_retry_at} marks the last attempt.
     * Capped and sorted oldest-attempt-first, so the sweep cannot outgrow one tick and never
     * starves a later refund behind the same first batch.
     *
     * @param refundStatus the outstanding flag, i.e. {@link RefundStatus#REQUESTED}
     * @param statuses     states in which the payout is the open item
     * @param dueBefore    refunds last commanded at or before this instant are due again
     * @return at most 50 due refunds, the longest-unanswered first
     */
    List<Order> findTop50ByRefundStatusAndStatusInAndRefundRetryAtBeforeOrderByRefundRetryAtAsc(
            RefundStatus refundStatus, Collection<OrderStatus> statuses, OffsetDateTime dueBefore);
}
