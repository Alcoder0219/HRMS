import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Slide from '@mui/material/Slide';

const ToastContext = createContext(null);

/**
 * Transient feedback for things that already happened.
 *
 * Deliberately not a replacement for inline alerts. A toast is right for the
 * outcome of an action the user just took -- "saved", "3 sessions signed out"
 * -- because it confirms and gets out of the way. It is wrong for anything the
 * user must read to proceed: a validation summary, a warning that mail is not
 * configured, an error that needs a decision. Those stay on the page, where
 * they cannot be missed by looking away for four seconds.
 *
 * Errors get a longer life and no auto-dismiss on hover, because the one thing
 * worse than a missed success is a missed failure.
 */

const AUTO_HIDE = { success: 4000, info: 4000, warning: 6000, error: 8000 };

const SlideUp = (props) => <Slide {...props} direction="up" />;

export const ToastProvider = ({ children, max = 3 }) => {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (severity, message, options = {}) => {
      if (!message) return null;

      counter.current += 1;
      const id = counter.current;

      setToasts((current) => {
        // Identical messages stack up when a loop reports each failure. Showing
        // the same sentence three times tells the reader nothing new.
        const deduped = current.filter((toast) => toast.message !== message);
        const next = [...deduped, { id, severity, message, title: options.title ?? null, action: options.action ?? null }];
        return next.slice(-max);
      });

      return id;
    },
    [max],
  );

  const value = useMemo(
    () => ({
      success: (message, options) => push('success', message, options),
      error: (message, options) => push('error', message, options),
      info: (message, options) => push('info', message, options),
      warning: (message, options) => push('warning', message, options),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/* One anchored stack rather than one Snackbar per toast, so several
          results from the same action do not overlap each other. */}
      <Snackbar
        open={toasts.length > 0}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        TransitionComponent={SlideUp}
        sx={{ maxWidth: '100%' }}
      >
        <Stack spacing={1} sx={{ width: { xs: 'calc(100vw - 32px)', sm: 400 } }}>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
          ))}
        </Stack>
      </Snackbar>
    </ToastContext.Provider>
  );
};

/**
 * Each toast owns its own timer.
 *
 * A shared timer on the Snackbar would dismiss the whole stack when the oldest
 * expired, taking a fresh error down with a four-second-old success.
 */
const ToastItem = ({ toast, onDismiss }) => {
  const [paused, setPaused] = useState(false);

  // Hovering holds the toast open: reading a message should not be a race
  // against its own timer. The cleanup also cancels the timer if the toast is
  // dismissed by hand first, so a stale callback cannot fire against an id
  // that has already gone.
  useEffect(() => {
    if (paused) return undefined;

    const timer = setTimeout(() => onDismiss(toast.id), AUTO_HIDE[toast.severity] ?? 5000);
    return () => clearTimeout(timer);
  }, [paused, toast.id, toast.severity, onDismiss]);

  return (
    <Alert
      severity={toast.severity}
      variant="filled"
      onClose={() => onDismiss(toast.id)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      action={toast.action}
      sx={{ width: '100%', alignItems: 'flex-start', boxShadow: 4 }}
    >
      {toast.title && <AlertTitle>{toast.title}</AlertTitle>}
      {toast.message}
    </Alert>
  );
};

/**
 * Never throws when the provider is missing.
 *
 * A screen rendered in a test harness or in isolation should degrade to silence
 * rather than crashing on a call that only ever decorated the interaction.
 */
export const useToast = () => useContext(ToastContext) ?? NO_OP;

const NO_OP = {
  success: () => null,
  error: () => null,
  info: () => null,
  warning: () => null,
  dismiss: () => null,
};

export default ToastProvider;
