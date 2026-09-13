export function FootballOptions({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return <div role="group" aria-label={label} className="flex gap-1 overflow-x-auto rounded-full border border-border-subtle bg-bg-card p-1">
    {options.map(option => <button type="button" key={option.value} aria-pressed={value === option.value} onClick={() => onChange(option.value)}
      onFocus={event => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
      className={`min-h-11 min-w-max flex-1 cursor-pointer rounded-full px-3 py-2 text-[15px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-turf ${value === option.value ? 'bg-text-primary text-bg-base' : 'text-text-secondary hover:bg-bg-elevated'}`}>
      {option.label}
    </button>)}
  </div>;
}
