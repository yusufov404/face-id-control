# FaceSys Enterprise — RBAC huquqlar matritsasi

## Rollar

| Rol | Kodi | Tavsif |
|---|---|---|
| Super Admin | `super_admin` | To'liq tizim boshqaruvi |
| Bosh shifokor | `chief_physician` | Barcha bo'limlar bo'yicha ko'rish + eksport |
| Kadrlar bo'limi boshlig'i | `hr_director` | HR boshqaruvi, davomat tuzatish (audit bilan) |
| Bo'lim boshlig'i | `department_head` | Faqat o'z bo'limini ko'rish |
| Kuzatuvchi/Auditor | `auditor` | Barcha bo'limlar bo'yicha faqat o'qish (ruxsat etilgan ma'lumotlar) |

## Ruxsatlar matritsasi

Belgilar: ✅ = ruxsat, ❌ = yo'q, 🔒 = faqat o'z bo'limi doirasida.

| Ruxsat | Super Admin | Bosh shifokor | Kadrlar | Bo'lim boshlig'i | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| **Foydalanuvchilar** | | | | | |
| `user:create` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `user:read` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `user:update` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `user:delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `user:assign_role` | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Rollar** | | | | | |
| `role:create/update/delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `role:read` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `role:assign_permission` | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Bo'limlar** | | | | | |
| `department:create/update/delete` | ✅ | ❌ | ✅/✅/❌ | ❌ | ❌ |
| `department:read` | ✅ | ✅ | ✅ | 🔒 | ✅ |
| `department:view_all` | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Xodimlar** | | | | | |
| `employee:create` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `employee:read` | ✅ | ✅ | ✅ | 🔒 | ✅ |
| `employee:update` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `employee:delete` | ✅ | ❌ | ✅ (soft delete) | ❌ | ❌ |
| `employee:change_status` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `employee:view_all` | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Lavozimlar** | | | | | |
| `position:create/update/delete` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `position:read` | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Qurilmalar** | | | | | |
| `device:create/update/delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `device:read` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `device:sync` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `device:view_logs` | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Davomat** | | | | | |
| `attendance:read` | ✅ | ✅ | ✅ | 🔒 | ✅ |
| `attendance:read_all` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `attendance:correct` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `attendance:correct_all` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `attendance:export` | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Smenalar** | | | | | |
| `shift:create/update/delete/assign` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `shift:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Bayram / Ta'til** | | | | | |
| `holiday:create/update/delete` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `holiday:read` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `leave:create` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `leave:read` | ✅ | ✅ | ✅ | 🔒 | ❌ |
| `leave:read_all` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `leave:approve` | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Hisobotlar** | | | | | |
| `report:view` | ✅ | ✅ | ✅ | 🔒 | ✅ |
| `report:export` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `report:dashboard` | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Audit** | | | | | |
| `audit:read` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `audit:export` | ✅ | ❌ | ✅ | ❌ | ❌ |
| **Sozlamalar** | | | | | |
| `settings:read` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `settings:update` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `settings:backup/restore` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `system:admin` | ✅ | ❌ | ❌ | ❌ | ❌ |

## Rol darajasidagi cheklovlar (kod bilan majburlanadi)

| Cheklov | Super Admin | Bosh shifokor | Kadrlar | Bo'lim boshlig'i | Auditor |
|---|:--:|:--:|:--:|:--:|:--:|
| `can_manage_users` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `can_manage_roles` | ✅ | ❌ | ❌ (Super Admin bera olmaydi) | ❌ | ❌ |
| `can_access_all_departments` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `can_modify_attendance` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `can_access_system_settings` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `can_view_audit_logs` | ✅ | ❌ | ✅ | ❌ | ❌ |
| `max_department_scope` | 0 (hammasi) | 0 | 0 | 1 (o'z bo'limi) | 0 |

## Majburlash nuqtalari (backend)

1. **`require_permission(Permission.X)`** — FastAPI dependency; har bir himoyalangan endpointda.
2. **`get_scope_department_id(user)`** — `department_head` uchun `department_id` ni qaytaradi; `can_access_all_departments=False` bo'lsa, barcha query'larga `WHERE department_id = :scope` qo'shiladi.
3. **Object-level check** — `GET /employees/{id}` da xodimning `department_id` foydalanuvchi scope'ida ekanligi tekshiriladi (IDOR himoyasi).
4. **Role escalation guard** — `hr_director` `super_admin` rolini bera olmaydi; `POST /users/{id}/roles` da tekshiriladi.
5. **Audit** — barcha yozuv amallari `AuditLog` yaratadi (`user_id`, `old_values`, `new_values`, `reason`).

## Test qamrovi

- Har bir rol uchun ruxsat/ruxsatsizlik testlari: `tests/test_rbac.py`.
- Bo'lim boshlig'i boshqa bo'lim ID'si bilan so'rovi → `404`:
  `tests/test_department_isolation.py`.
- Bosh shifokor va auditor uchun yozuv amallari → `403`: `tests/test_rbac.py`.
- Kadrlar tuzatishi va audit yozuvi: `tests/test_attendance.py`,
  `tests/test_audit.py`.
- `hr_director` → `super_admin` rol berish → `403`: `tests/test_rbac.py`.
- Faqat o'qish rollari uchun barcha yozuv endpointlari → `403`:
  `tests/test_rbac.py`.