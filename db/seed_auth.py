import os
import sys

# Add the project root to sys.path to allow imports from db and backend
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.orm import Session
from db.database import SessionLocal, engine, Base
from db.models import Role, Department, Faculty, User, UserRoleAssignment
from authorization.auth_utils import hash_password

def seed_rbac():
    # Ensure tables are created
    Base.metadata.create_all(bind=engine)
    
    db: Session = SessionLocal()
    try:
        # 1. Create Roles
        roles_data = [
            {"name": "super_admin", "description": "Full access to the entire system"},
            {"name": "dept_admin", "description": "Can manage a specific department"},
            {"name": "faculty_affairs_admin", "description": "Can manage registrars within assigned faculty"},
            {"name": "coordinator", "description": "Can match courses and approve/reject"},
            {"name": "registrar", "description": "Can view transcripts and grade conversions for assigned faculty"},
            {"name": "student", "description": "Can select courses and view status"},
        ]
        
        roles = {}
        for r_data in roles_data:
            role = db.query(Role).filter(Role.name == r_data["name"]).first()
            if not role:
                role = Role(**r_data)
                db.add(role)
                db.commit()
                db.refresh(role)
            roles[r_data["name"]] = role
        
        # 2. Create Faculties
        faculties_data = [
            {"name": "Faculty of Engineering", "code": "ENG"},
            {"name": "Faculty of Architecture", "code": "ARCH"},
        ]

        faculties = {}
        for f_data in faculties_data:
            fac = db.query(Faculty).filter(Faculty.code == f_data["code"]).first()
            if not fac:
                fac = Faculty(**f_data)
                db.add(fac)
                db.commit()
                db.refresh(fac)
            faculties[f_data["code"]] = fac

        # 3. Create Departments
        depts_data = [
            {"name": "Computer Engineering", "code": "COM", "faculty_id": faculties["ENG"].id},
        ]

        depts = {}
        for d_data in depts_data:
            dept = db.query(Department).filter(Department.code == d_data["code"]).first()
            if not dept:
                dept = Department(**d_data)
                db.add(dept)
                db.commit()
                db.refresh(dept)
            depts[d_data["code"]] = dept

        # 4. Create Super Admin User
        admin_eid = "admin"
        admin_pass = os.getenv("ADMIN_PASSWORD")
        if not admin_pass:
            raise ValueError("ADMIN_PASSWORD environment variable must be set to run seed script")
        
        admin_user = db.query(User).filter(User.eid == admin_eid).first()
        if not admin_user:
            admin_user = User(
                eid=admin_eid,
                name="System Administrator",
            )
            db.add(admin_user)
            db.commit()
            db.refresh(admin_user)
        
        # Always update password and ensure role
        admin_user.password_hash = hash_password(admin_pass)
        db.commit()

        # Ensure super_admin role
        assignment = db.query(UserRoleAssignment).filter(
            UserRoleAssignment.user_id == admin_user.id,
            UserRoleAssignment.role_id == roles["super_admin"].id
        ).first()
        
        if not assignment:
            assignment = UserRoleAssignment(
                user_id=admin_user.id,
                role_id=roles["super_admin"].id
            )
            db.add(assignment)
            db.commit()
        
        print(f"Super admin ensured: {admin_eid}")
            
        print("RBAC seeding completed successfully.")
        
    except Exception as e:
        print(f"Error seeding RBAC: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_rbac()
