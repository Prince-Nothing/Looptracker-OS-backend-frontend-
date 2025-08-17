'use client';

import MessageSkeleton from "./MessageSkeleton";

// This component displays a series of animated skeletons to show
// that the chat history is currently being loaded.
export default function ChatAreaSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <MessageSkeleton />
      <MessageSkeleton justifyEnd />
      <MessageSkeleton />
      <MessageSkeleton justifyEnd />
      <MessageSkeleton />
    </div>
  );
}