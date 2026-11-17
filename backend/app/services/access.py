"""Row-level access rules shared by services and routers."""
from app.core.errors import Forbidden
from app.models import Employee, User

HR = "hr_admin"
MANAGER = "manager"
EMPLOYEE = "employee"
ACCOUNTS = "accounts"


def can_view_employee(user: User, emp: Employee) -> bool:
    role = user.role_name
    if role in (HR, ACCOUNTS):
        return True
    if user.employee_id == emp.id:
        return True
    return role == MANAGER and user.employee_id is not None and emp.manager_id == user.employee_id


def can_approve_for(user: User, emp: Employee) -> bool:
    if user.role_name == HR:
        return True
    return (user.role_name == MANAGER and user.employee_id is not None and emp.manager_id == user.employee_id
            and emp.id != user.employee_id)


def ensure_view(user: User, emp: Employee) -> None:
    if not can_view_employee(user, emp):
        raise Forbidden("You do not have access to this employee")


def ensure_approve(user: User, emp: Employee) -> None:
    if not can_approve_for(user, emp):
        raise Forbidden("Only the employee's manager or HR can decide this request")
