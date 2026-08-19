import { Router } from "express";
import * as submissionController from "../controllers/paymentSubmission.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  approveSubmissionSchema,
  rejectSubmissionSchema,
  submissionListSchema,
} from "../validators/paymentSubmission.schema";

const auth = toHandler(authMiddleware);
const canReview = requireRole("superadmin", "admin");

const paymentSubmissionRouter = Router();
paymentSubmissionRouter.use(auth);

paymentSubmissionRouter.get("/", validate(submissionListSchema, "query"), submissionController.list);
paymentSubmissionRouter.post(
  "/:id/approve",
  canReview,
  validate(idParamSchema, "params"),
  validate(approveSubmissionSchema),
  submissionController.approve
);
paymentSubmissionRouter.post(
  "/:id/reject",
  canReview,
  validate(idParamSchema, "params"),
  validate(rejectSubmissionSchema),
  submissionController.reject
);

export default paymentSubmissionRouter;
