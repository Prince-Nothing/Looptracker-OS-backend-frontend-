'use client';

// A simple component to represent a single loading message bubble.
// The 'justify-end' prop determines if it's aligned left (AI) or right (user).
export default function MessageSkeleton({ justifyEnd = false }: { justifyEnd?: boolean }) {
  return (
    <div className={`flex items-start gap-4 ${justifyEnd ? 'justify-end' : 'justify-start'}`}>
      {!justifyEnd && <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse flex-shrink-0"></div>}
      <div className="flex flex-col gap-2">
        <div className={`h-5 w-48 rounded-md bg-gray-700 animate-pulse`}></div>
        <div className={`h-5 w-32 rounded-md bg-gray-700 animate-pulse`}></div>
      </div>
      {justifyEnd && <div className="w-8 h-8 rounded-full bg-gray-700 animate-pulse flex-shrink-0"></div>}
    </div>
  );
}