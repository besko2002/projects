import { useState } from 'react';
import { api } from '../api/api';
import { errorMessage } from '../api/ApiError';
import type { EmployeeProfile } from '../api/types';
import { useAuth } from '../auth/useAuth';
import { Banner } from './Banner';
import { Field } from './Field';
import { Modal } from './Modal';
import { Card } from './states';

type Props = { employee: EmployeeProfile; onReset?: () => void };

export function ResetPasswordPanel(props: Props): JSX.Element | null {
  const { role, user } = useAuth();
  if (!user || (role !== 'HR' && role !== 'ADMIN') || user.id === props.employee.id
      || props.employee.status !== 'ACTIVE' || (props.employee.role === 'ADMIN' && role !== 'ADMIN')) {
    return null;
  }
  return <ResetControls key={`${user.id}:${props.employee.id}`} {...props} />;
}

function ResetControls({ employee, onReset }: Props): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const [acknowledged, setAcknowledged] = useState(false);

  async function reset(): Promise<void> {
    if (!reason.trim() || reason.length > 400) {
      setError('Enter an audit reason of 1 to 400 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.resetEmployeePassword(employee.id, { reason: reason.trim() });
      setSecret(result.temporaryPassword);
      setReason('');
      setConfirming(false);
      setCopied('idle');
      setAcknowledged(false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function dismissSecret(): void {
    if (!acknowledged) return;
    setSecret(null);
    setAcknowledged(false);
    setCopied('idle');
    onReset?.();
  }

  async function copy(): Promise<void> {
    if (secret === null) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
  }

  return (
    <Card title="Password recovery">
      <p>Reset this employee’s password after verifying their identity. All existing sessions will be revoked.</p>
      <button type="button" className="button" disabled={secret !== null} onClick={() => { setError(null); setConfirming(true); }}>
        Reset password
      </button>
      {confirming && (
        <Modal title="Confirm password reset" onClose={() => { if (!busy) setConfirming(false); }} footer={
          <button type="button" className="button button-primary" disabled={busy} onClick={() => { void reset(); }}>
            {busy ? 'Resetting…' : 'Confirm reset'}
          </button>
        }>
          <Banner tone="warning">This will revoke all sessions for {employee.fullName}. They must change the temporary password at next sign-in.</Banner>
          <Field id="password-reset-reason" label="Audit reason" required hint="Do not include passwords or other credentials.">
            <textarea id="password-reset-reason" value={reason} maxLength={400} required disabled={busy}
              aria-describedby="password-reset-reason-hint" onChange={(event) => setReason(event.target.value)} />
          </Field>
          {error && <Banner tone="error">{error}</Banner>}
        </Modal>
      )}
      {secret !== null && (
        <Modal title="Temporary password" onClose={dismissSecret} footer={
          <button type="button" className="button button-primary" disabled={!acknowledged} onClick={dismissSecret}>Done</button>
        }>
          <Banner tone="warning">Shown once only. Share securely with {employee.fullName}; this password cannot be retrieved again.</Banner>
          <div className="secret-row">
            <code className="secret" aria-label="Temporary password">{secret}</code>
            <button type="button" className="button" onClick={() => { void copy(); }}>Copy</button>
          </div>
          <p aria-live="polite">{copied === 'done' ? 'Copied to the clipboard.' : copied === 'failed' ? 'Could not reach the clipboard — copy it by hand.' : ''}</p>
          <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I have securely shared or recorded this password.</label>
        </Modal>
      )}
    </Card>
  );
}
