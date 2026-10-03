import {
  BedDouble,
  BookOpen,
  Briefcase,
  Camera,
  Car,
  Code,
  Coffee,
  Dumbbell,
  Film,
  Footprints,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  House,
  Laptop,
  Leaf,
  Music,
  Paintbrush,
  Pencil,
  Phone,
  ShoppingCart,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";

/**
 * `activity.symbol` stores SF Symbol-style names so the Swift apps can use SF Symbols directly;
 * the desktop maps them to Lucide (rebuild-plan 3.1).
 */
export const SYMBOLS: ReadonlyArray<[name: string, icon: LucideIcon]> = [
  ["briefcase", Briefcase],
  ["laptopcomputer", Laptop],
  ["chevron.left.forwardslash.chevron.right", Code],
  ["book", BookOpen],
  ["graduationcap", GraduationCap],
  ["pencil", Pencil],
  ["paintbrush", Paintbrush],
  ["music.note", Music],
  ["camera", Camera],
  ["film", Film],
  ["gamecontroller", Gamepad2],
  ["figure.walk", Footprints],
  ["dumbbell", Dumbbell],
  ["heart", Heart],
  ["leaf", Leaf],
  ["fork.knife", Utensils],
  ["cup.and.saucer", Coffee],
  ["bed.double", BedDouble],
  ["house", House],
  ["cart", ShoppingCart],
  ["car", Car],
  ["person.2", Users],
  ["phone", Phone],
  ["globe", Globe],
];

const byName = new Map(SYMBOLS);

export function symbolIcon(name: string | null | undefined): LucideIcon | undefined {
  return name ? byName.get(name) : undefined;
}
