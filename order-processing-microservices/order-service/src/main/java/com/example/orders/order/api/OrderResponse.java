package com.example.orders.order.api;

import com.example.orders.order.domain.Order;
import com.example.orders.order.domain.OrderStatus;
import com.example.orders.order.domain.RefundStatus;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * An order as the API shows it. {@code version} and {@code idempotencyKey} stay inside: one is a
 * persistence detail, the other is the client's own bookkeeping echoed back to nobody.
 *
 * @param id            order id
 * @param orderNumber   short human-facing reference derived from the id
 * @param userId        owner
 * @param status        where the order stands in the saga
 * @param totalAmount   sum of the line totals
 * @param currency      ISO 4217 code
 * @param failureReason why the order was rejected or cancelled; absent while it is fine
 * @param paymentUrl    the hosted checkout page the customer finishes paying at, while the order
 *                      waits for its payment; absent otherwise (the answer, whatever it was, has
 *                      arrived)
 * @param refundStatus  the saga's own refund bookkeeping ({@code NONE} while nothing is owed): a
 *                      cancellation is final, but a charge that completed for it still has to be
 *                      given back, and the customer is entitled to see that progress
 * @param createdAt     when it was accepted
 * @param updatedAt     last status change
 * @param items         the priced lines
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record OrderResponse(
        UUID id,
        String orderNumber,
        UUID userId,
        OrderStatus status,
        BigDecimal totalAmount,
        String currency,
        String failureReason,
        String paymentUrl,
        RefundStatus refundStatus,
        OffsetDateTime createdAt,
        OffsetDateTime updatedAt,
        List<OrderItemResponse> items) {

    /**
     * @param order stored order; its lines must already be loaded
     * @return its public representation
     */
    public static OrderResponse of(Order order) {
        boolean waitingForPayment = OrderStatus.STOCK_HELD.contains(order.getStatus());
        return new OrderResponse(
                order.getId(),
                order.getOrderNumber(),
                order.getUserId(),
                order.getStatus(),
                order.getTotalAmount(),
                order.getCurrency(),
                order.getFailureReason(),
                waitingForPayment ? order.getPaymentUrl() : null,
                order.getRefundStatus(),
                order.getCreatedAt(),
                order.getUpdatedAt(),
                order.getItems().stream().map(OrderItemResponse::of).toList());
    }
}
