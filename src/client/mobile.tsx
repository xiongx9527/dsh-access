import { createElement as h, useEffect, useState } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';

const MOBILE_QUERY = '(max-width: 640px)';

export function setMobileNavigationOpen(open: boolean, root: Pick<HTMLElement, 'toggleAttribute'> | null = typeof document === 'undefined' ? null : document.documentElement): void {
  root?.toggleAttribute('data-dsh-access-mobile-nav-open', open);
}

export function MobileNavigation(props: PropsLocale<'dshaccess'>) {
  const [mobile, setMobile] = useState(false);
  const [open, setOpenState] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) {
        setMobileNavigationOpen(false);
        setOpenState(false);
      }
    };
    update();
    query.addEventListener?.('change', update);
    return () => {
      query.removeEventListener?.('change', update);
      setMobileNavigationOpen(false);
    };
  }, []);

  if (!mobile) return null;
  const toggle = () => {
    const next = !open;
    setOpenState(next);
    setMobileNavigationOpen(next);
  };
  const close = () => { setOpenState(false); setMobileNavigationOpen(false); };
  return h(
    'div',
    { className: 'dsh-access-mobile-nav' },
    open ? h('button', { className: 'dsh-access-mobile-backdrop', 'aria-label': props.t('mobileCloseNav'), onClick: close }) : null,
    h('button', {
      className: 'dsh-access-mobile-toggle',
      'aria-label': open ? props.t('mobileCloseNav') : props.t('mobileOpenNav'),
      'aria-expanded': open,
      onClick: toggle,
    }, open ? '×' : '☰'),
  );
}
