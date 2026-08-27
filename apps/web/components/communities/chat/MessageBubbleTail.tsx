interface MessageBubbleTailProps {
  className?: string;
}

export function MessageBubbleTail({ className = "" }: MessageBubbleTailProps) {
  return (
    <svg
      viewBox="0 0 8 13"
      height="13"
      width="8"
      preserveAspectRatio="xMidYMid meet"
      version="1.1"
      enableBackground="new 0 0 8 13"
      aria-hidden="true"
      className={`pointer-events-none absolute -left-2 top-0 z-10 h-[13px] w-2 ${className}`}
    >
      <title>tail-in</title>
      <path
        fill="#0000000"
        d="M1.533,3.568L8,12.193V1H2.812 C1.042,1,0.474,2.156,1.533,3.568z"
      />
      <path
        fill="currentColor"
        d="M1.533,2.568L8,11.193V0L2.812,0 C1.042,0,0.474,1.156,1.533,2.568z"
      />
    </svg>
  );
}
