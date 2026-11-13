import { useAppSelector } from '@hooks/useRedux.js';
import { selectCurrentUser } from '@redux/slices/authSlice.js';
import { resolveUnitAccess } from '@utils/unitAccess.js';

/** The signed-in account's unit reach. See utils/unitAccess.js -- display only. */
const useUnitAccess = () => resolveUnitAccess(useAppSelector(selectCurrentUser));

export default useUnitAccess;
