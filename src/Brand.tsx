import type { MouseEvent } from "react";

export function Brand({
  href = "/",
  onClick,
}: {
  href?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <a className="brand" href={href} onClick={onClick} aria-label="OpenQuest network">
      <img className="brand-mark" src="/favicon.svg" width={29} height={29} alt="" />
      OPENQUEST
    </a>
  );
}
