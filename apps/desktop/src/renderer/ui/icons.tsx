import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 15, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {children}
    </svg>
  );
}

export const Ic = {
  Home: (p: P) => <I {...p}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></I>,
  Inbox: (p: P) => <I {...p}><path d="M3 13l2.5-8h13L21 13v7H3z" /><path d="M3 13h5l2 3h4l2-3h5" /></I>,
  Runs: (p: P) => <I {...p}><path d="M3 12h4l3-8 4 16 3-8h4" /></I>,
  Hash: (p: P) => <I {...p}><path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16" /></I>,
  Settings: (p: P) => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></I>,
  Search: (p: P) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></I>,
  Pause: (p: P) => <I strokeWidth={2.4} {...p}><path d="M8 5v14M16 5v14" /></I>,
  Play: (p: P) => <I {...p}><path d="M7 4l12 8-12 8z" /></I>,
  Plus: (p: P) => <I strokeWidth={2.4} {...p}><path d="M12 5v14M5 12h14" /></I>,
  Back: (p: P) => <I strokeWidth={2.2} {...p}><path d="M15 18l-6-6 6-6" /></I>,
  Fwd: (p: P) => <I strokeWidth={2.2} {...p}><path d="M9 6l6 6-6 6" /></I>,
  UpDown: (p: P) => <I strokeWidth={2.4} {...p}><path d="M7 9l5-5 5 5M7 15l5 5 5-5" /></I>,
  Sidebar: (p: P) => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></I>,
  Clock: (p: P) => <I strokeWidth={2.2} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>,
  Check: (p: P) => <I strokeWidth={2.4} {...p}><path d="M5 12l5 5L20 7" /></I>,
  Branch: (p: P) => <I {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="8" r="2.5" /><path d="M6 8.5v7M18 10.5c0 3-3 4-6 4.5-2 .3-4 1-6 3" /></I>,
  Question: (p: P) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5" /><path d="M12 17h.01" /></I>,
  Shield: (p: P) => <I {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></I>,
  Sparkle: (p: P) => <I {...p}><path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" /></I>,
  File: (p: P) => <I {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></I>,
  Edit: (p: P) => <I {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></I>,
  Terminal: (p: P) => <I {...p}><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></I>,
  Send: (p: P) => <I strokeWidth={2.2} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></I>,
  Team: (p: P) => <I strokeWidth={2.2} {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 20a5 5 0 0 1 6 0" /></I>,
  Person: (p: P) => <I {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></I>,
  Flame: (p: P) => <I {...p}><path d="M12 3c-3 4-7 6-7 11a7 7 0 0 0 14 0c0-5-4-7-7-11z" /><path d="M12 21v-6" /></I>,
  Lock: (p: P) => <I {...p}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></I>,
  Note: (p: P) => <I {...p}><path d="M4 5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="M8 13h8M8 17h5" /></I>,
  Dollar: (p: P) => <I {...p}><path d="M12 2v20" /><path d="M17 6.5C17 4.6 14.8 3 12 3S7 4.6 7 6.5 9.2 10 12 10s5 1.6 5 3.5S14.8 17 12 17s-5-1.6-5-3.5" /></I>,
  Chat: (p: P) => <I {...p}><path d="M4 5h16v10H8l-4 4z" /></I>,
  Folder: (p: P) => <I {...p}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></I>,
  X: (p: P) => <I strokeWidth={2.2} {...p}><path d="M6 6l12 12M18 6L6 18" /></I>,
  Trash: (p: P) => <I {...p}><path d="M4 7h16M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M10 11v6M14 11v6" /></I>,
  Archive: (p: P) => <I {...p}><path d="M3 5h18v4H3zM5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></I>,
  TriDown: (p: P) => <svg width={p.size ?? 10} height={p.size ?? 10} viewBox="0 0 24 24" fill="currentColor"><path d="M6 8l6 8 6-8z" /></svg>,
  TriRight: (p: P) => <svg width={p.size ?? 10} height={p.size ?? 10} viewBox="0 0 24 24" fill="currentColor"><path d="M8 6l8 6-8 6z" /></svg>,
};
