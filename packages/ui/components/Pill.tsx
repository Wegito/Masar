import { cn } from '@/lib/utils';
export default function Pill({ children, className }: { children: React.ReactNode; className?: string; }) {
    return <span className={cn('px-2 py-1 rounded-full text-xs bg-white/10', className)}>{children}</span>;
}