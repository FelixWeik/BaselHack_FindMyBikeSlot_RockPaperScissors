const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

type IconProps = { size?: number; filled?: boolean };

const icon = (path: React.ReactNode) =>
  function Icon({ size = 24 }: IconProps) {
    return (
      <svg {...base} width={size} height={size}>
        {path}
      </svg>
    );
  };

export const MapIcon = icon(
  <>
    <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </>,
);

export const ForecastIcon = icon(
  <>
    <path d="M4 5v14h16" />
    <path d="m8 15 3-4 3 2 4-6" />
  </>,
);

export const ParkingsIcon = icon(
  <>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3" />
  </>,
);

export const SettingsIcon = icon(
  <>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </>,
);

export const ArrowRightIcon = icon(<path d="M5 12h14M13 6l6 6-6 6" />);
export const ChevronRightIcon = icon(<path d="m9 6 6 6-6 6" />);
export const CloseIcon = icon(<path d="M6 6l12 12M18 6 6 18" />);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />);
export const PencilIcon = icon(<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3l-1-1a2.1 2.1 0 0 0-3 0L4 16v4Z" />);
export const UndoIcon = icon(<path d="M8 6 4 10l4 4M4 10h10a5 5 0 0 1 0 10h-3" />);
export const TrashIcon = icon(<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" />);
export const ShareIcon = icon(<path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6" />);
export const DownloadIcon = icon(<path d="M12 4v11M8 11l4 4 4-4M5 20h14" />);
export const ShieldIcon = icon(<path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.500 7-10V6l-7-3Z" />);
export const WrenchIcon = icon(<path d="M15 6a4 4 0 0 0-5 5l-6 6 3 3 6-6a4 4 0 0 0 5-5l-3 3-2-1-1-2 3-3Z" />);
export const FlaskIcon = icon(<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3M7.500 15h9" />);
export const OfflineIcon = icon(<path d="M3 3l18 18M8.500 16.500a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-3M19 13a10 10 0 0 0-3-2M2 9a15 15 0 0 1 4-3M22 9a15 15 0 0 0-11-4M12 20h.01" />);
export const ArrowUpIcon = icon(<path d="M7 17 17 7M9 7h8v8" />);
export const ArrowDownIcon = icon(<path d="M7 7l10 10M17 9v8H9" />);
export const ArrowFlatIcon = icon(<path d="M5 12h14M14 7l5 5-5 5" />);

export function StarIcon({ size = 24, filled = false }: IconProps) {
  return (
    <svg {...base} width={size} height={size} fill={filled ? "currentColor" : "none"}>
      <path d="m12 3.500 2.600 5.400 5.900.800-4.300 4.100 1.100 5.900L12 16.800l-5.300 2.900 1.100-5.900L3.500 9.700l5.900-.800L12 3.500Z" />
    </svg>
  );
}
