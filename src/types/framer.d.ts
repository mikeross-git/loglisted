declare module "framer" {
  import type { ComponentType } from "react";

  export enum ControlType {
    Boolean = "Boolean",
    Color = "Color",
    Number = "Number",
    String = "String",
  }

  export enum RenderTarget {
    canvas = "CANVAS",
    preview = "PREVIEW",
    export = "EXPORT",
    thumbnail = "THUMBNAIL",
  }

  export namespace RenderTarget {
    function current(): RenderTarget;
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
