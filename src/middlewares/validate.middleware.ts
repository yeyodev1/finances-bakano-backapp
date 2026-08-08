import { NextFunction, Request, Response } from "express";
import { ZodType } from "zod";
import { CustomError } from "../errors/customError.error";

type ValidationSource = "body" | "query" | "params";

export function validate(schema: ZodType, source: ValidationSource = "body") {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || source,
        message: issue.message,
      }));

      const error = new CustomError("Datos inválidos en la solicitud", 400, details);
      res.status(error.status).json({ message: error.message, details: error.details });
      return;
    }

    Object.defineProperty(req, source, {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });

    next();
  };
}
