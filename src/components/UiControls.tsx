import { ListBox, Select, Switch } from "@heroui/react";
import { Check } from "lucide-react";
import { useI18n } from "../i18n";

export type SelectOption = { id: string; label: string; description?: string };

export function UxSelect({ value, options, label, placeholder, className, onChange, isDisabled = false }: {
  value: string;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  className?: string;
  onChange: (value: string) => void;
  isDisabled?: boolean;
}) {
  const { t } = useI18n();
  const selectedLabel = options.find((option) => option.id === value)?.label;
  return (
    <div className={`ux-select-shell ${className ?? ""}`} title={selectedLabel}>
      <Select aria-label={label} className="ux-select" fullWidth placeholder={placeholder ?? t("common.select")} value={value || null} onChange={(key) => onChange(key == null ? "" : String(key))} isDisabled={isDisabled} variant="secondary">
        <Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger>
        <Select.Popover><ListBox>{options.map((option) => <ListBox.Item key={option.id} id={option.id} textValue={option.label}><span className="ux-select-option"><span title={option.label}>{option.label}</span>{option.description && <small>{option.description}</small>}</span><ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover>
      </Select>
    </div>
  );
}

export function UxSwitch({ selected, label, onChange, isDisabled = false }: { selected: boolean; label: string; onChange: (value: boolean) => void; isDisabled?: boolean }) {
  return <Switch className="ux-switch" aria-label={label} isSelected={selected} onChange={onChange} isDisabled={isDisabled} size="md"><Switch.Content><Switch.Control><Switch.Thumb><Switch.Icon><Check size={11} strokeWidth={2.6} /></Switch.Icon></Switch.Thumb></Switch.Control></Switch.Content></Switch>;
}
