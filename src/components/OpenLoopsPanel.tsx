'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import LoopBuilder from '@/components/LoopBuilder';

export default function OpenLoopsPanel() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <Card className="glass rounded-2xl">
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Open Loops</CardTitle>
            <CardDescription>Capture → Befriend (IFS) → Analyze (CBT) → Chunk (tiny habit)</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Chip>Autonomy-first</Chip>
            <Chip>Therapy-informed</Chip>
            <Chip>Habit-ready</Chip>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <LoopBuilder />
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
            <div>
              Pro tip: Use <kbd className="rounded border border-white/20 bg-white/10 px-1">Tab</kbd> to move forward,
              <kbd className="ml-1 rounded border border-white/20 bg-white/10 px-1">Shift</kbd>+
              <kbd className="rounded border border-white/20 bg-white/10 px-1">Tab</kbd> to go back.
            </div>
            <div className="flex items-center gap-2">
              <Button variant="subtle" size="sm">Guide</Button>
              <Button variant="subtle" size="sm">Examples</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
