interface AppIconProps {
  name: "chevron-left" | "chevron-right";
  size?: number;
}

export const AppIcon = ({ name, size = 20 }: AppIconProps): JSX.Element => {
  const path = name === "chevron-left" ? "m14.5 6-6 6 6 6" : "m9.5 6 6 6-6 6";
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
