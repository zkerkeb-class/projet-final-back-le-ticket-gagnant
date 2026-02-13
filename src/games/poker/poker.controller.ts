import { Router } from "express";

const pokerRouter = Router();

pokerRouter.post("/settle", async (req, res) => {
  return res.status(403).json({
    message: "Endpoint désactivé pour raisons de sécurité. Le règlement poker doit être calculé côté serveur.",
  });
});

export default pokerRouter;
