import { Link } from 'react-router';
import { EmptyState } from '../components/Feedback';

export function NotFoundPage() {
  return (
    <>
      <div className="page-header">
        <h1>Page not found</h1>
      </div>
      <EmptyState title="This page does not exist.">
        <p className="muted">The address may be mistyped, or the page may have moved.</p>
        <p>
          <Link className="btn btn--primary" to="/">
            Back to the catalog
          </Link>
        </p>
      </EmptyState>
    </>
  );
}
