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
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const originalViewport = viewport?.content ?? '';
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    const update = () => {
      setMobile(query.matches);
      if (query.matches) {
        if (viewport) viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
        themeColor.content = getComputedStyle(document.body).backgroundColor;
        if (!themeColor.parentElement) document.head.appendChild(themeColor);
      } else {
        if (viewport) viewport.content = originalViewport;
        themeColor.remove();
      }
      if (!query.matches) {
        setMobileNavigationOpen(false);
        setOpenState(false);
      }
    };
    const closeAfterSidebarSelection = (event: Event) => {
      if (!query.matches) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[class*="_sidebar"]')) {
        setMobileNavigationOpen(false);
        setOpenState(false);
      }
    };
    update();
    query.addEventListener?.('change', update);
    document.addEventListener('click', closeAfterSidebarSelection, true);
    return () => {
      query.removeEventListener?.('change', update);
      document.removeEventListener('click', closeAfterSidebarSelection, true);
      if (viewport) viewport.content = originalViewport;
      themeColor.remove();
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
