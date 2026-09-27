import express from 'express';
import cors from 'cors';
import { errorHandler } from './middlewares/errorHandler';
import { requestCorrelation } from './middlewares/requestCorrelation';
import authRoutes from './routes/auth.routes';
import workspaceRoutes from './routes/workspace.routes';
import { projectRoutes, workspaceProjectRoutes } from './routes/project.routes';
import { environmentRoutes, projectEnvironmentRoutes } from './routes/environment.routes';
import { projectSpecRoutes, specRoutes } from './routes/spec.routes';
import testCaseRoutes from './routes/test-case.routes';
import testRunRoutes from './routes/test-run.routes';
import analyticsRoutes from './routes/analytics.routes';
import testScheduleRoutes from './routes/test-schedule.routes';
import { AppError } from './utils/AppError';

const app = express();

// Middlewares
app.use(requestCorrelation);
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['application/yaml', 'text/yaml', 'application/x-yaml'], limit: '5mb' }));

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'OK' });
});

const api = express.Router();
api.use('/auth', authRoutes);
api.use('/workspaces', workspaceRoutes);
api.use('/workspaces', workspaceProjectRoutes);
api.use('/projects', projectRoutes);
api.use('/projects', projectEnvironmentRoutes);
api.use('/environments', environmentRoutes);
api.use('/projects', projectSpecRoutes);
api.use('/specs', specRoutes);
api.use(testCaseRoutes);
api.use(testRunRoutes);
api.use(testScheduleRoutes);
api.use(analyticsRoutes);

app.use('/api', api);

app.use('/api', (_req, _res, next) => next(new AppError('Route not found', 404, true, 'NOT_FOUND')));

// Global Error Handler (must be last middleware)
app.use(errorHandler);

export default app;
