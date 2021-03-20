FROM python:3
ENV PYTHONUNBUFFERED=1
WORKDIR /code
COPY requirements.txt /code/
RUN pip install -U wheel pip
RUN pip install -r requirements.txt
COPY . /code/

ENTRYPOINT [ "python3", "main.py" ]
