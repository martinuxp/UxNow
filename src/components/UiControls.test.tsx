import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UxSwitch } from "./UiControls";

describe("UxSwitch", () => {
  it("toggles through its accessible control and reports the next value", () => {
    const onChange = vi.fn();
    const { rerender } = render(<UxSwitch label="Buscar letras online" selected={false} onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Buscar letras online" });
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<UxSwitch label="Buscar letras online" selected={true} onChange={onChange} />);
    expect(control).toHaveProperty("checked", true);
  });
});
