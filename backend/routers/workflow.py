from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import WorkflowStateLog, User
from authorization.middleware import require_admin_or_coordinator

router = APIRouter(prefix="/api/workflow", tags=["workflow"])


@router.get("/{entity_type}/{entity_id}/history")
async def get_workflow_history(
    entity_type: str,
    entity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_coordinator()),
):
    """Get state transition history for an entity."""
    if entity_type not in ("student_application", "student_course_selection"):
        raise HTTPException(status_code=400, detail="Invalid entity_type")

    logs = (
        db.query(WorkflowStateLog)
        .filter(
            WorkflowStateLog.entity_type == entity_type,
            WorkflowStateLog.entity_id == entity_id,
        )
        .order_by(WorkflowStateLog.created_at.desc())
        .all()
    )

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "history": [
            {
                "id": log.id,
                "from_state": log.from_state,
                "to_state": log.to_state,
                "actor_role": log.actor_role,
                "reason": log.reason,
                "metadata": {},
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
    }
