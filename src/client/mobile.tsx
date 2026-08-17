import { createElement as h, useEffect, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

const MOBILE_QUERY = '(max-width: 640px)';

function setOpen(open: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.toggleAttribute('data-dshpw-mobile-nav-open', open);
}

export function MobileNavigation(props: PropsLocale<'dshpw'>) {
  const [mobile, setMobile] = useState(false);
  const [open, setOpenState] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) {
        setOpen(false);
        setOpenState(false);
      }
    };
    update();
    query.addEventListener?.('change', update);
    return () => {
      query.removeEventListener?.('change', update);
      setOpen(false);
    };
  }, []);

  if (!mobile) return null;
  const toggle = () => {
    const next = !open;
    setOpenState(next);
    setOpen(next);
  };
  const close = () => { setOpenState(false); setOpen(false); };
  return h(
    'div',
    { className: 'dshpw-mobile-nav' },
    open ? h('button', { className: 'dshpw-mobile-backdrop', 'aria-label': props.t('mobileCloseNav'), onClick: close }) : null,
    h('button', {
      className: 'dshpw-mobile-toggle',
      'aria-label': open ? props.t('mobileCloseNav') : props.t('mobileOpenNav'),
      'aria-expanded': open,
      onClick: toggle,
    }, open ? '×' : '☰'),
  );
}
