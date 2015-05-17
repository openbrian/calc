"""
Django settings for hourglass project.

For more information on this file, see
https://docs.djangoproject.com/en/1.7/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/1.7/ref/settings/
"""

# Build paths inside the project like this: os.path.join(BASE_DIR, ...)
import os
import sys
import dj_database_url
BASE_DIR = os.path.dirname(os.path.dirname(__file__))

API_HOST = os.environ.get('API_HOST', '/calc/api/')


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/1.7/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = 'i=-6!=jo-qh3sh!z=uo_2)5wf*_@ogw9eam3e0_53hp4)cp53!'

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = False

TEMPLATE_DEBUG = False
TEMPLATE_DIRS = (
    os.path.join(BASE_DIR, 'hourglass/templates'),
    os.path.join(BASE_DIR, 'hourglass_site/templates'),
)

ALLOWED_HOSTS = ['*']


# Application definition

INSTALLED_APPS = (
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',

    'hourglass_site',

    'contracts',
    'api',
    'djorm_pgfulltext',
    'rest_framework',

    'django_nose',
    'corsheaders',
)

MIDDLEWARE_CLASSES = (
    'django.contrib.sessions.middleware.SessionMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    #'django.contrib.auth.middleware.SessionAuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
)

TEMPLATE_CONTEXT_PROCESSORS = (
    'hourglass.context_processors.api_host',
    "django.contrib.auth.context_processors.auth",
    "django.core.context_processors.debug",
    "django.core.context_processors.i18n",
    "django.core.context_processors.media",
    'django.core.context_processors.request',
    "django.core.context_processors.static",
    "django.core.context_processors.tz",
    "django.contrib.messages.context_processors.messages"

)

ROOT_URLCONF = 'hourglass.urls'

WSGI_APPLICATION = 'hourglass.wsgi.application'

TEST_RUNNER = 'django_nose.NoseTestSuiteRunner'


# Internationalization
# https://docs.djangoproject.com/en/1.7/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_L10N = True

USE_TZ = True

#django cors headers
CORS_ORIGIN_ALLOW_ALL = True

# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/1.7/howto/static-files/

STATIC_URL = '/static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'static')

STATICFILES_DIRS = (
#    os.path.join(BASE_DIR, 'static'),
)
STATICFILES_STORAGE = 'whitenoise.django.GzipManifestStaticFilesStorage'

PAGINATION = 200
REST_FRAMEWORK = {
    'COERCE_DECIMAL_TO_STRING': False,
    'WHITELIST': eval(os.environ.get('WHITELISTED_IPS', 'False')),
    'DEFAULT_PERMISSION_CLASSES': (
        'api.permissions.WhiteListPermission',
    ),

}

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format' : "[%(asctime)s] %(levelname)s [%(name)s:%(lineno)s] %(message)s",
            'datefmt' : "%d/%b/%Y %H:%M:%S"
        },
        'simple': {
            'format': '%(levelname)s %(message)s'
        },
    },
    'handlers': {
        'file': {
            'level': 'DEBUG',
            'class': 'logging.FileHandler',
            'filename': os.path.join(BASE_DIR, 'logs/hourglass.log'),
            'formatter': 'verbose'
        },
        'contracts_file': {
            'level': 'DEBUG',
            'class': 'logging.FileHandler',
            'filename': os.path.join(BASE_DIR, 'logs/load_data.log'),
            'formatter': 'verbose'
        },
        'console': {
            'level': 'INFO',
            'class': 'logging.StreamHandler',
            'formatter': 'verbose'
        },
    },
    'loggers': {
        'django': {
            'handlers':['console', 'file'],
            'propagate': True,
            'level':'INFO',
        },
        'contracts': {
            'handlers': ['console', 'contracts_file'],
            'propagate': True,
            'level':'INFO',
        },
    },
}

DATABASES = {}
DATABASES['default'] =  dj_database_url.config()

try:
    from hourglass.local_settings import *
except:
    pass


