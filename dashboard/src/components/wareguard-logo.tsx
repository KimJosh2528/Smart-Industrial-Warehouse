type WareGuardLogoProps = {
  compact?: boolean;
  className?: string;
};

export function WareGuardLogo({ compact = false, className = "" }: WareGuardLogoProps) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-label="WareGuard">
      <svg width={compact ? 40 : 48} height={compact ? 44 : 52} viewBox="0 0 48 52" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="wareguard-logo-gradient" x1="7" y1="4" x2="41" y2="47" gradientUnits="userSpaceOnUse">
            <stop stopColor="#28B8FF" />
            <stop offset="0.52" stopColor="#2877FF" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <path d="M24 2 43 11v14c0 12-7.6 20.6-19 25C12.6 45.6 5 37 5 25V11L24 2Z" fill="url(#wareguard-logo-gradient)" fillOpacity=".15" stroke="url(#wareguard-logo-gradient)" strokeWidth="2.4" />
        <path d="m10.5 14.2 4.2 17.6 5.3-10.3 4 10.3 8.2-17.6 4.3-2.1v11.6c0 8.8-4.5 15-12.5 19.1-8-4.1-12.5-10.3-12.5-19.1V12.1l3.1 2.1Z" fill="url(#wareguard-logo-gradient)" />
        <path d="m16.5 15.7 3.5 12.4 4-8.1 3.7 8.1 5.7-12.4" stroke="#07182C" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!compact && <div><p className="text-[16px] font-semibold leading-5 text-white">WareGuard</p><p className="mt-1 text-[10px] text-slate-400">Access &amp; Safety System</p></div>}
    </div>
  );
}
