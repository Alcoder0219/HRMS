import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/**
 * A labelled dashboard section.
 *
 * `lazy` mounts the content only once the section comes within a screen of the
 * viewport, so sections far down the page -- and the requests inside them --
 * wait until someone scrolls towards them. Until then a block of the expected
 * height holds its place, so the page does not jump.
 */
const Section = ({ title, icon: Icon = null, action = null, lazy = false, placeholderHeight = 320, children, sx = null }) => {
  const anchor = useRef(null);
  const [visible, setVisible] = useState(!lazy);

  useEffect(() => {
    if (visible || !anchor.current) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(anchor.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <Box component="section" ref={anchor} sx={{ mb: 3, ...sx }}>
      <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center', justifyContent: 'space-between' }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
          {Icon && <Icon fontSize="small" sx={{ color: 'text.secondary' }} />}
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }} noWrap>
            {title}
          </Typography>
        </Stack>
        {action}
      </Stack>
      {visible ? children : <Box sx={{ height: placeholderHeight }} />}
    </Box>
  );
};

export default Section;
