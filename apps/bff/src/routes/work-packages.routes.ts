import { Router } from "express";
import {
  getWorkPackages,
  getWorkPackageById
} from "../services/work-packages.service";
import type { ApiResponse } from "../types/api.types";
import type { WorkPackage } from "../types/work-package.types";

const router = Router();

router.get("/", (_req, res) => {
  const workPackages = getWorkPackages();

  const response: ApiResponse<WorkPackage[]> = {
    success: true,
    data: workPackages
  };

  res.json(response);
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const workPackage = await getWorkPackageById(id);

  if (!workPackage) {
    return res.status(404).json({
      success: false,
      message: "Work package no encontrado"
    });
  }

  const response: ApiResponse<WorkPackage> = {
    success: true,
    data: workPackage
  };

  res.json(response);
});

export default router;