import { createContext } from "react";

export const OperationContext = createContext({
  error: "",
  busy: "",
  cancel: () => {},
});
