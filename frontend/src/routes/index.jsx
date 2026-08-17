import { createBrowserRouter } from 'react-router-dom';
import ROUTES from './routeTable.jsx';

/**
 * The application router.
 *
 * The tree itself lives in routeTable.jsx so it can be imported and inspected
 * outside a browser -- `createBrowserRouter` reaches for the History API at
 * module load, which is what made the route table untestable before.
 */
const router = createBrowserRouter(ROUTES);

export default router;
