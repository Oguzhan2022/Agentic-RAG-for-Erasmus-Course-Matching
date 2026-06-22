"""
Distributed Lock Manager using PostgreSQL `system_locks` table.
Replaces in-memory threading.Lock() to support horizontal scaling safely.
"""

import os
import socket
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from db.models import SystemLock

logger = logging.getLogger(__name__)


class DistributedLockManager:
    @staticmethod
    def acquire_lock(
        db: Session,
        name: str,
        expire_seconds: int = 600,
        worker_id: Optional[str] = None
    ) -> bool:
        """
        Try to acquire a lock with a given name.
        If the lock is active but hasn't received a heartbeat in `expire_seconds`, it's considered stale
        and will be forcefully overtaken.
        """
        if not worker_id:
            worker_id = f"{socket.gethostname()}-{os.getpid()}"

        now = datetime.now()
        lock = db.query(SystemLock).filter(SystemLock.name == name).first()

        if lock:
            # Check if active and not expired
            is_stale = False
            if lock.is_active and lock.last_heartbeat:
                # Calculate if heartbeat is older than expiration limit
                age = now - lock.last_heartbeat
                if age > timedelta(seconds=expire_seconds):
                    is_stale = True
                    logger.warning(
                        f"[DistributedLock] Lock '{name}' is active but stale (last heartbeat: {lock.last_heartbeat}, age: {age.total_seconds()}s). Forcefully acquiring."
                    )

            if not lock.is_active or is_stale:
                # Re-acquire lock
                lock.worker_id = worker_id
                lock.is_active = True
                lock.last_heartbeat = now
                lock.worker_pid = os.getpid()
                lock.hostname = socket.gethostname()
                try:
                    db.commit()
                    logger.info(f"[DistributedLock] Re-acquired lock '{name}' for worker '{worker_id}'")
                    return True
                except Exception as e:
                    db.rollback()
                    logger.error(f"[DistributedLock] Failed to commit lock re-acquisition for '{name}': {e}")
                    return False
            else:
                # Lock is active and fresh, cannot acquire
                return False
        else:
            # Create new lock
            lock = SystemLock(
                name=name,
                worker_id=worker_id,
                is_active=True,
                last_heartbeat=now,
                worker_pid=os.getpid(),
                hostname=socket.gethostname()
            )
            db.add(lock)
            try:
                db.commit()
                logger.info(f"[DistributedLock] Acquired new lock '{name}' for worker '{worker_id}'")
                return True
            except Exception as e:
                db.rollback()
                logger.error(f"[DistributedLock] Failed to commit new lock acquisition for '{name}': {e}")
                return False

    @staticmethod
    def release_lock(db: Session, name: str, worker_id: Optional[str] = None) -> bool:
        """Release a lock if it belongs to the current worker."""
        if not worker_id:
            worker_id = f"{socket.gethostname()}-{os.getpid()}"

        lock = db.query(SystemLock).filter(SystemLock.name == name).first()
        if lock and lock.is_active:
            if lock.worker_id == worker_id:
                lock.is_active = False
                try:
                    db.commit()
                    logger.info(f"[DistributedLock] Released lock '{name}' from worker '{worker_id}'")
                    return True
                except Exception as e:
                    db.rollback()
                    logger.error(f"[DistributedLock] Failed to release lock '{name}': {e}")
                    return False
            else:
                logger.warning(
                    f"[DistributedLock] Prevented attempt to release lock '{name}' owned by worker '{lock.worker_id}' by worker '{worker_id}'"
                )
        return False

    @staticmethod
    def heartbeat(db: Session, name: str, worker_id: Optional[str] = None) -> bool:
        """Update last_heartbeat for an active lock to prevent expiration."""
        if not worker_id:
            worker_id = f"{socket.gethostname()}-{os.getpid()}"

        lock = db.query(SystemLock).filter(SystemLock.name == name).first()
        if lock and lock.is_active and lock.worker_id == worker_id:
            lock.last_heartbeat = datetime.now()
            try:
                db.commit()
                return True
            except Exception as e:
                db.rollback()
                logger.error(f"[DistributedLock] Heartbeat failed for lock '{name}': {e}")
                return False
        return False
