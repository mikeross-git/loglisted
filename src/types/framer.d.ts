declare module "framer" {
  import type { ComponentType } from "react";

  export enum ControlType {
    Boolean = "Boolean",
    Color = "Color",
    Number = "Number",
    String = "String",
  }

  export interface PropertyControl {
    type: ControlType;
    title?: string;
    defaultValue?: string | number | boolean;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
  }

  export function addPropertyControls<Props>(
    component: ComponentType<Props>,
    controls: Record<string, PropertyControl>,
  ): void;
}
