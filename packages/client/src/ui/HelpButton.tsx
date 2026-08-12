interface HelpButtonProps {
  onClick: () => void;
}

/** Fixed corner "?" button -- present on both the join screen and the main panel, so instructions are reachable before and after powering on. */
export function HelpButton({ onClick }: HelpButtonProps) {
  return (
    <button className="help-fab" onClick={onClick} title="Help / instructions" aria-label="Help">
      ?
    </button>
  );
}
