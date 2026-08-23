export type AppIconName =
  | "calendar"
  | "assistant"
  | "brief"
  | "feed"
  | "chevron-left"
  | "chevron-right"
  | "extensions"
  | "grades"
  | "materials"
  | "overview"
  | "search"
  | "settings";

interface AppIconProps {
  name: AppIconName;
  size?: number;
}

export const AppIcon = ({ name, size = 20 }: AppIconProps): JSX.Element => {
  const commonProps = {
    "aria-hidden": true,
    className: "app-icon",
    fill: "none",
    height: size,
    viewBox: "0 0 24 24",
    width: size
  } as const;

  if (name === "overview") {
    return (
      <svg {...commonProps}>
        <path d="M5 4.75h5.5v6.5H5zM13.5 4.75H19v4.5h-5.5zM5 14.25h5.5v5H5zM13.5 12.25H19v7h-5.5z" />
      </svg>
    );
  }

  if (name === "calendar") {
    return (
      <svg {...commonProps}>
        <path d="M6.75 3.75v2.5M17.25 3.75v2.5M4.5 8.25h15M5.5 5.25h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
        <path d="M8 11.5h2M14 11.5h2M8 15.5h2M14 15.5h2" />
      </svg>
    );
  }

  if (name === "assistant") {
    return (
      <svg {...commonProps}>
        <path d="M5 6.5h14v10H9l-4 3v-13Z" />
        <path d="M8 10h8M8 13h5" />
      </svg>
    );
  }

  if (name === "brief") {
    return (
      <svg {...commonProps}>
        <path d="M4.75 5.5h11v13h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z" />
        <path d="M15.75 8h3.5v9.5a1 1 0 0 1-1 1h-3.5V8ZM7.5 8.75h5.5M7.5 11.75h5.5M7.5 14.75h3.5" />
      </svg>
    );
  }

  if (name === "extensions") {
    return (
      <svg {...commonProps}>
        <path d="M8.25 4.5h3.25v4.25H7.25V5.5a1 1 0 0 1 1-1ZM12.5 4.5h3.25a1 1 0 0 1 1 1v3.25H12.5V4.5ZM7.25 9.75h4.25V14H7.25V9.75ZM12.5 9.75h4.25V13h2.75v3.25h-2.75v3.25H12.5V9.75Z" />
      </svg>
    );
  }

  if (name === "feed") {
    return (
      <svg {...commonProps}>
        <circle cx="6.5" cy="17.5" r="1.75" />
        <path d="M6.5 11.25a6.25 6.25 0 0 1 6.25 6.25M6.5 5.5A12.5 12.5 0 0 1 19 18" />
      </svg>
    );
  }

  if (name === "grades") {
    return (
      <svg {...commonProps}>
        <path d="M5 4.75h14v14.5H5zM8 8h8M8 12h5M8 16h3" />
        <path d="m14.25 15.5 1.25 1.25 2.5-3" />
      </svg>
    );
  }

  if (name === "materials") {
    return (
      <svg {...commonProps}>
        <path d="M4.75 6.5h5l1.5 2h8v9.75a1 1 0 0 1-1 1H5.75a1 1 0 0 1-1-1V6.5Z" />
        <path d="M4.75 9.5h14.5" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.64 5.64l1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" />
      </svg>
    );
  }

  if (name === "search") {
    return (
      <svg {...commonProps}>
        <circle cx="10.75" cy="10.75" r="5.75" />
        <path d="m15 15 4 4" />
      </svg>
    );
  }

  const path =
    name === "chevron-left" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6";

  return (
    <svg {...commonProps}>
      <path d={path} />
    </svg>
  );
};
