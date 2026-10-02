import { motion } from "framer-motion";
import cn from "classnames";

export default function Capsule(
  {children, glow=false, onClick}:{children:React.ReactNode; glow?:boolean; onClick?:()=>void}
){
  return (
    <motion.div
      whileTap={{scale:0.98}}
      onClick={onClick}
      className={cn("capsule", glow && "capsule-glow")}
    >
      {children}
    </motion.div>
  );
}
