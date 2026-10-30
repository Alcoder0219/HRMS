import { useMemo, useState } from 'react';
import { Outlet, NavLink, Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import MenuIcon from '@mui/icons-material/Menu';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import LockResetIcon from '@mui/icons-material/LockResetOutlined';
import ExpandLessIcon from '@mui/icons-material/ExpandLessOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreOutlined';

import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import useAuth from '@hooks/useAuth.js';
import usePermissions from '@hooks/usePermissions.js';
import CurrencySelect from '@components/common/CurrencySelect.jsx';
import { toggleThemeMode, selectThemeMode, selectCurrency } from '@redux/slices/uiSlice.js';
import { NAV_GROUPS } from '@config/navigation.js';
import { initials } from '@utils/format.js';
import { PATHS } from '@routes/paths.js';
import BrandMark from '@components/common/BrandMark.jsx';

const DRAWER_WIDTH = 264;

const AppLayout = () => {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const themeMode = useAppSelector(selectThemeMode);
  const currency = useAppSelector(selectCurrency);
  const { user, roleLabel, signOut } = useAuth();
  const { can, hasScopeAtLeast, isSuperAdmin } = usePermissions();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState(null);

  /**
   * Groups are filtered, not hidden wholesale: a group survives if the user can
   * reach at least one item inside it, so a Manager sees an Attendance section
   * containing only what they hold rather than an empty heading.
   *
   * An entry needs its grant AND, where the API asks for one, the data reach to
   * go with it -- otherwise the menu offers a screen that always refuses.
   *
   * `hidden` is a third reason an entry does not appear, and the only one that
   * is not about the user: it marks a module that stays routable and reachable
   * but is deliberately left off the menu. It reads the same on a group as on
   * an item -- a hidden group takes its whole section out of the sidebar.
   */
  const groups = useMemo(
    () =>
      NAV_GROUPS.filter((group) => !group.hidden)
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) =>
              !item.hidden &&
              can(item.resource, item.action) && (!item.minScope || hasScopeAtLeast(item.minScope)),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [can, hasScopeAtLeast],
  );

  // Open the section containing the current page, and leave whatever the user
  // opens after that alone -- collapsing their choice on every navigation is
  // the usual complaint about accordion sidebars.
  const [openGroups, setOpenGroups] = useState(() => {
    const active = NAV_GROUPS.find((group) => group.items.some((item) => pathname.startsWith(item.to)));
    return new Set(active ? [active.id] : []);
  });

  const toggleGroup = (id) =>
    setOpenGroups((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSignOut = async () => {
    setAnchorEl(null);
    await signOut().catch(() => {});
    navigate(PATHS.auth.login, { replace: true });
  };

  const navButtonSx = (nested) => ({
    borderRadius: 1.5,
    mb: 0.25,
    pl: nested ? 2.5 : 1.5,
    // NavLink sets .active; styling through it keeps the highlight in sync with
    // the router rather than a duplicated state guess.
    '&.active': {
      bgcolor: 'primary.main',
      color: 'primary.contrastText',
      '& .MuiListItemIcon-root': { color: 'inherit' },
      '&:hover': { bgcolor: 'primary.dark' },
    },
  });

  const renderItem = (item, nested) => (
    <ListItemButton
      key={item.to}
      component={NavLink}
      to={item.to}
      // `end` stops a parent path staying highlighted while a child route is
      // open -- /attendance would otherwise light up on every /attendance/*.
      end={item.end ?? false}
      onClick={() => setMobileOpen(false)}
      sx={navButtonSx(nested)}
    >
      <ListItemIcon sx={{ minWidth: 34 }}>
        <item.icon fontSize="small" />
      </ListItemIcon>

      <ListItemText primaryTypographyProps={{ variant: 'body2', fontWeight: 500, noWrap: true }}>
        {item.label}
      </ListItemText>
    </ListItemButton>
  );

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Same height as the top bar, so the divider below lines up with its border. */}
      <Toolbar sx={{ px: 2.5 }}>
        <BrandMark variant="sidebar" />
      </Toolbar>

      <Divider />

      <List sx={{ px: 1.5, py: 1.5, flex: 1, overflowY: 'auto' }}>
        {groups.map((group) => {
          // A group without a label (the Dashboard) renders as a bare item.
          if (!group.label) return group.items.map((item) => renderItem(item, false));

          const open = openGroups.has(group.id);
          const containsActive = group.items.some((item) => pathname.startsWith(item.to));

          return (
            <Box key={group.id} sx={{ mb: 0.25 }}>
              <ListItemButton
                onClick={() => toggleGroup(group.id)}
                sx={{
                  borderRadius: 1.5,
                  // A collapsed section still shows it holds the current page.
                  color: containsActive && !open ? 'primary.main' : 'inherit',
                }}
              >
                <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                  <group.icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primaryTypographyProps={{ variant: 'body2', fontWeight: 600, noWrap: true }}
                >
                  {group.label}
                </ListItemText>
                {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
              </ListItemButton>

              <Collapse in={open} timeout="auto" unmountOnExit>
                <List disablePadding sx={{ mt: 0.25 }}>
                  {group.items.map((item) => renderItem(item, true))}
                </List>
              </Collapse>
            </Box>
          );
        })}
      </List>

      <Divider />

      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Signed in as
        </Typography>
        <Typography variant="body2" fontWeight={600} noWrap>
          {user?.fullName ?? user?.email}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {roleLabel}
          </Typography>
          {isSuperAdmin && <Chip label="Full access" size="small" color="primary" sx={{ height: 18, fontSize: 10 }} />}
        </Stack>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        elevation={0}
        color="inherit"
        sx={{
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          ml: { lg: `${DRAWER_WIDTH}px` },
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Toolbar>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ mr: 2, display: { lg: 'none' } }}
            aria-label="Open navigation"
          >
            <MenuIcon />
          </IconButton>

          {/* The sidebar is hidden below lg, so the brand rides in the top bar there. */}
          <Box sx={{ display: { xs: 'flex', lg: 'none' }, minWidth: 0 }}>
            <BrandMark variant="sidebar" compact />
          </Box>

          <Box sx={{ flex: 1 }} />

          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title={themeMode === 'light' ? 'Dark mode' : 'Light mode'}>
              <IconButton onClick={() => dispatch(toggleThemeMode())} aria-label="Toggle theme">
                {themeMode === 'light' ? <DarkModeIcon /> : <LightModeIcon />}
              </IconButton>
            </Tooltip>

            <CurrencySelect />

            <IconButton onClick={(event) => setAnchorEl(event.currentTarget)} aria-label="Account menu">
              <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 14 }}>
                {initials(user?.firstName, user?.lastName)}
              </Avatar>
            </IconButton>
          </Stack>

          <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
            <MenuItem disabled sx={{ opacity: '1 !important' }}>
              <Stack>
                <Typography variant="body2" fontWeight={600}>
                  {user?.fullName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.email}
                </Typography>
              </Stack>
            </MenuItem>
            <Divider />

            <MenuItem
              component={RouterLink}
              to={PATHS.changePassword}
              onClick={() => setAnchorEl(null)}
            >
              <ListItemIcon>
                <LockResetIcon fontSize="small" />
              </ListItemIcon>
              Change password
            </MenuItem>

            <MenuItem onClick={handleSignOut}>
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { lg: DRAWER_WIDTH }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant={isDesktop ? 'permanent' : 'temporary'}
          open={isDesktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              boxSizing: 'border-box',
              borderRight: 1,
              borderColor: 'divider',
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { lg: `calc(100% - ${DRAWER_WIDTH}px)` },
          bgcolor: 'background.default',
          minHeight: '100vh',
        }}
      >
        <Toolbar />

        {/*
          Keyed on the currency, so changing it remounts the page beneath.

          Amounts are written by `formatCurrency`, a plain function called from
          grid column definitions, exporters and print views as well as from
          components. Those callers cannot subscribe to the store, so nothing
          would repaint them and half the screen would sit in the old currency
          until the user navigated away -- the kind of stale figure that gets
          read as a real one on a payroll screen.

          Remounting costs the page its filters and a round of requests. That
          is affordable for a setting someone changes deliberately and rarely,
          and it is the only version of this that cannot leave an amount behind.
        */}
        <Box key={currency} sx={{ p: { xs: 2, md: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};

export default AppLayout;
