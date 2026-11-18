import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../api/client';
import { listMyOrders } from '../api/ordersApi';
import { EmptyState, ErrorNotice, Loading } from '../components/Feedback';
import { Pagination } from '../components/Pagination';
import { OrderStatusBadge, RefundBadge } from '../components/StatusBadge';
import { useAuth } from '../state/auth';
import type { OrderResponse, PageResponse } from '../types/api';
import { formatMoney } from '../utils/money';

export function OrdersPage() {
  const { user } = useAuth();
  const [page, setPage] = useState(0);
  const [data, setData] = useState<PageResponse<OrderResponse> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMyOrders(page)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // The account id is a dependency so switching accounts always refetches instead of showing
    // the previous customer's orders.
  }, [page, reloadKey, user?.id]);

  return (
    <>
      <div className="page-header">
        <h1>My orders</h1>
        <p className="page-lede">
          Current saga progress as recorded by the order service. Open an order for its server-side
          event timeline and refund state.
        </p>
      </div>

      {error && <ErrorNotice message={error} onRetry={() => setReloadKey((key) => key + 1)} />}
      {loading && !data && <Loading label="Loading your orders…" />}

      {!loading && !error && data && data.content.length === 0 && (
        <EmptyState title="No orders yet.">
          <p className="muted">Once you check out, every order and its progress appears here.</p>
          <p>
            <Link className="btn btn--primary" to="/">
              Browse the catalog
            </Link>
          </p>
        </EmptyState>
      )}

      {data && data.content.length > 0 && (
        <>
          <div className="table-scroll">
            <table className="table">
              <caption className="sr-only">Your orders</caption>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Placed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Total</th>
                  <th scope="col">Refund</th>
                  <th scope="col">
                    <span className="sr-only">Details</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((order) => (
                  <tr key={order.id}>
                    <td className="mono">{order.orderNumber}</td>
                    <td>{new Date(order.createdAt).toLocaleString()}</td>
                    <td>
                      <OrderStatusBadge status={order.status} />
                    </td>
                    <td className="table--num">{formatMoney(order.totalAmount, order.currency)}</td>
                    <td>
                      {order.refundStatus === 'NONE' ? (
                        <span className="muted">—</span>
                      ) : (
                        <RefundBadge status={order.refundStatus} />
                      )}
                    </td>
                    <td>
                      <Link className="btn btn--small" to={`/orders/${order.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            totalElements={data.totalElements}
            itemLabel="orders"
            onChange={setPage}
          />
        </>
      )}
    </>
  );
}
