import { useDispatch, useSelector } from 'react-redux';

/**
 * Thin aliases over react-redux. Components import these instead of the
 * library directly, so store wiring can change (typed hooks, a custom context)
 * without touching every consumer.
 */
export const useAppDispatch = () => useDispatch();
export const useAppSelector = useSelector;
