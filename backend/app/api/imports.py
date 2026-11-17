from fastapi import APIRouter, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import DB, HROnly
from app.core.errors import NotFound
from app.models import ColumnMappingTemplate, ImportBatch, ImportRow, User
from app.repositories.base import paginate
from app.schemas.common import PageOut, page_out
from app.schemas.ops import (ImportBatchOut, ImportRowOut, ImportSummaryOut, InspectIn, InspectOut, TemplateIn,
                             TemplateOut, ValidateIn)
from app.services import cycle_service, import_service

router = APIRouter(prefix="/imports", tags=["imports"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("", response_model=PageOut[ImportBatchOut])
def history(page: int = 1, page_size: int = Query(20, le=100), db: Session = DB, _=HROnly):
    return page_out(paginate(db, select(ImportBatch).order_by(ImportBatch.created_at.desc()), page, page_size),
                    ImportBatchOut)


@router.get("/template.xlsx")
def template(layout: str = "wide", cycle_id: int | None = None, db: Session = DB, user: User = HROnly):
    cyc = cycle_service.get(db, cycle_id) if cycle_id else cycle_service.current(db)
    data = import_service.template_xlsx(db, layout, cyc, user)
    db.commit()
    return Response(data, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="attendance_template_{layout}.xlsx"'})


@router.get("/templates", response_model=list[TemplateOut])
def templates(db: Session = DB, _=HROnly):
    return list(db.scalars(select(ColumnMappingTemplate).order_by(ColumnMappingTemplate.name)))


@router.post("/templates", response_model=TemplateOut, status_code=201)
def save_template(body: TemplateIn, db: Session = DB, user: User = HROnly):
    t = db.scalar(select(ColumnMappingTemplate).where(ColumnMappingTemplate.name == body.name))
    if t:
        t.mapping, t.layout = body.mapping, body.layout
    else:
        t = ColumnMappingTemplate(name=body.name, layout=body.layout, mapping=body.mapping, created_by_id=user.id)
        db.add(t)
    db.commit()
    return t


@router.delete("/templates/{tpl_id}", status_code=204)
def delete_template(tpl_id: int, db: Session = DB, _=HROnly):
    t = db.get(ColumnMappingTemplate, tpl_id)
    if not t:
        raise NotFound("Template not found")
    db.delete(t)
    db.commit()


@router.post("/upload", response_model=InspectOut, status_code=201)
async def upload(file: UploadFile = File(...), db: Session = DB, user: User = HROnly):
    out = import_service.upload(db, file.filename or "upload.xlsx", await file.read(), user)
    db.commit()
    return out


@router.get("/{batch_id}", response_model=ImportSummaryOut)
def get_batch(batch_id: int, db: Session = DB, _=HROnly):
    return import_service.summary(db, import_service.get(db, batch_id))


@router.post("/{batch_id}/inspect", response_model=InspectOut)
def inspect(batch_id: int, body: InspectIn, db: Session = DB, _=HROnly):
    b = import_service.get(db, batch_id)
    if body.sheet:
        b.sheet_name = body.sheet
    out = import_service.inspect(db, b, body.sheet, body.header_row, body.cycle_id)
    db.commit()
    return {"batch": b, **out}


@router.post("/{batch_id}/validate", response_model=ImportSummaryOut)
def validate(batch_id: int, body: ValidateIn, db: Session = DB, user: User = HROnly):
    out = import_service.validate(db, import_service.get(db, batch_id), body.mapping, user, body.sheet,
                                  body.save_template)
    db.commit()
    return out


@router.get("/{batch_id}/rows", response_model=PageOut[ImportRowOut])
def rows(batch_id: int, severity: str | None = None, page: int = 1, page_size: int = Query(100, le=1000),
         db: Session = DB, _=HROnly):
    stmt = select(ImportRow).where(ImportRow.batch_id == batch_id)
    if severity:
        stmt = stmt.where(ImportRow.severity == severity)
    return page_out(paginate(db, stmt.order_by(ImportRow.row_number, ImportRow.id), page, page_size), ImportRowOut)


@router.get("/{batch_id}/preview")
def preview(batch_id: int, db: Session = DB, _=HROnly):
    return import_service.preview_grid(db, import_service.get(db, batch_id))


@router.get("/{batch_id}/errors.xlsx")
def errors_xlsx(batch_id: int, db: Session = DB, user: User = HROnly):
    b = import_service.get(db, batch_id)
    return Response(import_service.error_rows_xlsx(db, b, user), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="import_{b.id}_issues.xlsx"'})


@router.post("/{batch_id}/commit")
def commit(batch_id: int, db: Session = DB, user: User = HROnly):
    out = import_service.commit(db, import_service.get(db, batch_id), user)
    db.commit()
    return out


@router.post("/{batch_id}/rollback")
def rollback(batch_id: int, db: Session = DB, user: User = HROnly):
    out = import_service.rollback(db, import_service.get(db, batch_id), user)
    db.commit()
    return out


