interface AppIconProps {
  name: "chevron-left" | "chevron-right" | "calendar";
  size?: number;
}

export const AppIcon = ({ name, size = 20 }: AppIconProps): JSX.Element => {
  const path = name === "chevron-left" ? "m14.5 6-6 6 6 6" : name === "chevron-right" ? "m9.5 6 6 6-6 6" : "M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z";
  return (
    <svg
      aria-hidden="true"
      className="app-icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={path} />
    </svg>
  );
};
