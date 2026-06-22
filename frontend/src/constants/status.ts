import React from 'react';
import {
  ClockCircleOutlined,
  SyncOutlined,
  PauseCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  EditOutlined,
  RollbackOutlined,
  FileDoneOutlined,
  StopOutlined,
} from '@ant-design/icons';
import type { ApplicationStatus, SelectionStatus, UploadJobStatus, MatchJobStatus } from '../types';

export interface StatusConfigItem {
  color: string;
  icon: React.ReactNode;
  label: string;
}

/**
 * Upload Job Status Configuration
 */
export const UPLOAD_STATUS_CONFIG: Record<UploadJobStatus, StatusConfigItem> = {
  queued:    { color: '#1677ff', icon: React.createElement(ClockCircleOutlined),   label: 'Queued' },
  uploading: { color: '#fa8c16', icon: React.createElement(SyncOutlined, { spin: true }), label: 'Uploading' },
  parsing:   { color: '#c0392b', icon: React.createElement(SyncOutlined, { spin: true }), label: 'Parsing' },
  embedding: { color: '#2f54eb', icon: React.createElement(SyncOutlined, { spin: true }), label: 'Embedding' },
  paused:    { color: '#595959', icon: React.createElement(PauseCircleOutlined),    label: 'Paused' },
  completed: { color: '#52c41a', icon: React.createElement(CheckCircleOutlined),    label: 'Completed' },
  cancelled: { color: '#8c8c8c', icon: React.createElement(CloseCircleOutlined),   label: 'Cancelled' },
  failed:    { color: '#ff4d4f', icon: React.createElement(WarningOutlined),        label: 'Failed' },
};

/**
 * Match Job Status Configuration
 */
export const MATCH_STATUS_CONFIG: Record<MatchJobStatus, StatusConfigItem> = {
  queued:    { color: '#1677ff', icon: React.createElement(ClockCircleOutlined),   label: 'Queued' },
  matching:  { color: '#fa8c16', icon: React.createElement(SyncOutlined, { spin: true }), label: 'Matching' },
  verifying: { color: '#c0392b', icon: React.createElement(SyncOutlined, { spin: true }), label: 'Verifying' },
  paused:    { color: '#595959', icon: React.createElement(PauseCircleOutlined),    label: 'Paused' },
  completed: { color: '#52c41a', icon: React.createElement(CheckCircleOutlined),    label: 'Completed' },
  cancelled: { color: '#8c8c8c', icon: React.createElement(CloseCircleOutlined),   label: 'Cancelled' },
  failed:    { color: '#ff4d4f', icon: React.createElement(WarningOutlined),        label: 'Failed' },
};

/**
 * Application Status Configuration
 */
export const APP_STATUS_CONFIG: Record<ApplicationStatus, StatusConfigItem> = {
  draft:                    { color: '#d9d9d9', icon: React.createElement(EditOutlined),      label: 'Draft' },
  submitted:                { color: '#1677ff', icon: React.createElement(ClockCircleOutlined), label: 'Submitted' },
  rejected:                 { color: '#ff4d4f', icon: React.createElement(CloseCircleOutlined), label: 'Rejected' },
  learning_agreement_ready: { color: '#52c41a', icon: React.createElement(FileDoneOutlined),   label: 'LA Ready' },
  revision_requested:       { color: '#faad14', icon: React.createElement(RollbackOutlined),   label: 'Revision Requested' },
};

/**
 * Selection Status Configuration
 */
export const SELECTION_STATUS_CONFIG: Record<SelectionStatus, StatusConfigItem> = {
  not_selected:          { color: '#d9d9d9', icon: React.createElement(StopOutlined),              label: 'Not Selected' },
  draft_selected:        { color: '#8c8c8c', icon: React.createElement(EditOutlined),              label: 'Draft' },
  submitted_for_review:  { color: '#1677ff', icon: React.createElement(ClockCircleOutlined),       label: 'Pending' },
  approved:              { color: '#52c41a', icon: React.createElement(SafetyCertificateOutlined), label: 'Approved' },
  rejected:              { color: '#ff4d4f', icon: React.createElement(CloseCircleOutlined),       label: 'Rejected' },
  manual_review_required: { color: '#faad14', icon: React.createElement(FileSearchOutlined),        label: 'Manual Review' },
};

/**
 * Transcript Status Configuration
 */
export const TRANSCRIPT_STATUS_CONFIG: Record<string, StatusConfigItem> = {
  uploaded:            { color: '#8c8c8c', icon: React.createElement(ClockCircleOutlined), label: 'transcripts.status.uploaded' },
  student_grading:     { color: '#fa8c16', icon: React.createElement(EditOutlined), label: 'transcripts.status.studentGrading' },
  pending_review:      { color: '#13c2c2', icon: React.createElement(ClockCircleOutlined), label: 'transcripts.status.pendingReview' },
  grading_in_progress: { color: '#fa8c16', icon: React.createElement(SyncOutlined, { spin: true }), label: 'transcripts.status.grading' },
  graded:              { color: '#52c41a', icon: React.createElement(CheckCircleOutlined), label: 'transcripts.status.graded' },
  finalized:           { color: '#722ed1', icon: React.createElement(SafetyCertificateOutlined), label: 'transcripts.status.finalized' },
};
