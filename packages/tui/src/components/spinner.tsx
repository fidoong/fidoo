import { Text } from "ink";
import { useSyncExternalStore } from "react";
import { animationFrame, subscribeAnimation } from "../animation-clock.js";
import { theme } from "../theme.js";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function Spinner({
  active,
  color = theme.brand,
  staticIcon = "●",
}: {
  active: boolean;
  color?: string;
  staticIcon?: string;
}) {
  if (!active || process.env.FIDOO_MOTION === "off") {
    return <Text color={color}>{staticIcon}</Text>;
  }
  return <AnimatedSpinner color={color} />;
}

function AnimatedSpinner({ color }: { color: string }) {
  const frame = useSyncExternalStore(subscribeAnimation, animationFrame, animationFrame);
  return <Text color={color}>{frames[frame % frames.length]}</Text>;
}
