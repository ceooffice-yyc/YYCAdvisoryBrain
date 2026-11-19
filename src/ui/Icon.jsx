// The icons.
// Split out of src/App.jsx (PERF-02): the code is unchanged, only moved.

export const Icon = ({ name, size = 16, stroke = 2, color = "currentColor", className }) => {
  const paths = {
    book: <><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z" /><path d="M4 17.5A2.5 2.5 0 0 1 6.5 15H19" /></>,
    chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
    scale: <><path d="M12 3v18" /><path d="M5 7h14" /><path d="M7.5 7 4 14a3.5 3.5 0 0 0 7 0z" /><path d="M16.5 7 13 14a3.5 3.5 0 0 0 7 0z" /></>,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></>,
    close: <path d="M18 6 6 18M6 6l12 12" />,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
    edit: <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" /></>,
    check: <path d="M20 6 9 17l-5-5" />,
    lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
    unlock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></>,
    upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m17 8-5-5-5 5" /><path d="M12 3v12" /></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
    spark: <path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l3 3M16 16l3 3M5 19l3-3M16 8l3-3" />,
    download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
    arrowLeft: <path d="M19 12H5M12 19l-7-7 7-7" />,
    arrowRight: <path d="M5 12h14M12 5l7 7-7 7" />,
    chevronDown: <path d="m6 9 6 6 6-6" />,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    brain: <><path d="M12 4a4 4 0 0 0-4 4v1a3 3 0 0 0-1 5.8V17a3 3 0 0 0 5 2V4z" /><path d="M12 4a4 4 0 0 1 4 4v1a3 3 0 0 1 1 5.8V17a3 3 0 0 1-5 2V4z" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    filter: <path d="M3 4h18l-7 9v6l-4 2v-8z" />,
    tag: <><path d="M20 12 12 20l-8-8V4h8z" /><circle cx="8" cy="8" r="1.2" /></>,
  };
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {paths[name] || null}
    </svg>
  );
};