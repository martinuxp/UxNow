import { Tooltip } from "@heroui/react";

export function DeviceName({ name, className = "" }: { name: string; className?: string }) {
  return (
    <Tooltip delay={450}>
      <Tooltip.Trigger><span className={`device-name ${className}`} title={name}>{name}</span></Tooltip.Trigger>
      <Tooltip.Content placement="top">{name}</Tooltip.Content>
    </Tooltip>
  );
}