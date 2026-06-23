from fastapi import HTTPException, status


class AppException(HTTPException):
    """Base application exception."""
    def __init__(self, detail: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        super().__init__(status_code=status_code, detail=detail)


# ── Auth ──────────────────────────────────────────────────────────────────────

class UnauthorizedException(AppException):
    def __init__(self, detail: str = "Not authenticated"):
        super().__init__(detail=detail, status_code=status.HTTP_401_UNAUTHORIZED)


class ForbiddenException(AppException):
    def __init__(self, detail: str = "Permission denied"):
        super().__init__(detail=detail, status_code=status.HTTP_403_FORBIDDEN)


class InvalidCredentialsException(AppException):
    def __init__(self):
        super().__init__(detail="Invalid email or password", status_code=status.HTTP_401_UNAUTHORIZED)


class TokenExpiredException(AppException):
    def __init__(self):
        super().__init__(detail="Token has expired", status_code=status.HTTP_401_UNAUTHORIZED)


# ── Resources ─────────────────────────────────────────────────────────────────

class NotFoundException(AppException):
    def __init__(self, resource: str = "Resource"):
        super().__init__(detail=f"{resource} not found", status_code=status.HTTP_404_NOT_FOUND)


class ConflictException(AppException):
    def __init__(self, detail: str = "Resource already exists"):
        super().__init__(detail=detail, status_code=status.HTTP_409_CONFLICT)


# ── Validation ────────────────────────────────────────────────────────────────

class ValidationException(AppException):
    def __init__(self, detail: str):
        super().__init__(detail=detail, status_code=status.HTTP_422_UNPROCESSABLE_ENTITY)


# ── AI ────────────────────────────────────────────────────────────────────────

class AIProviderException(AppException):
    def __init__(self, detail: str = "AI provider error"):
        super().__init__(detail=detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


class AIRateLimitException(AppException):
    def __init__(self):
        super().__init__(detail="AI rate limit exceeded", status_code=status.HTTP_429_TOO_MANY_REQUESTS)


# ── Payments ──────────────────────────────────────────────────────────────────

class PaymentException(AppException):
    def __init__(self, detail: str = "Payment failed"):
        super().__init__(detail=detail, status_code=status.HTTP_402_PAYMENT_REQUIRED)


class SubscriptionRequiredException(AppException):
    def __init__(self):
        super().__init__(
            detail="Active subscription required",
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
        )


# ── Storage ───────────────────────────────────────────────────────────────────

class FileTooLargeException(AppException):
    def __init__(self, max_mb: int):
        super().__init__(
            detail=f"File exceeds maximum size of {max_mb}MB",
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        )


class UnsupportedFileTypeException(AppException):
    def __init__(self, mime_type: str):
        super().__init__(
            detail=f"File type '{mime_type}' is not supported",
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        )
