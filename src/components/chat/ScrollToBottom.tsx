'use client';

type Props = { visible: boolean; onClick: () => void };

export default function ScrollToBottom({ visible, onClick }: Props) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-28 right-8 z-20 rounded-full border border-white/10 bg-white/10 p-2 backdrop-blur-md hover:bg-white/20"
      aria-label="Scroll to bottom"
      title="Scroll to bottom"
    >
      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6.7 8.7 12 14l5.3-5.3 1.4 1.4-6 6a1 1 0 0 1-1.4 0l-6-6 1.4-1.4Z" />
      </svg>
    </button>
  );
}
