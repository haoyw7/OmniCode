"""API-Bank ToolManager; explicit local registry replaces upstream discovery.
The five dispatch/initialization/description methods below are upstream verbatim.
"""
import copy
import json
from pathlib import Path
from .registry import CLASSES
from eval_data import data_path

class ToolManager:
    def __init__(self, initial_databases=None):
        if initial_databases is None:
            fixture_dir = data_path('public/api_bank/fixtures')
            initial_databases = {p.stem: json.loads(p.read_text()) for p in sorted(fixture_dir.glob('*.json'))}
        self.init_databases = copy.deepcopy(initial_databases)
        self.apis = []
        self.inited_tools = {}
        for cls in CLASSES:
            info = {'name': cls.__name__, 'class': cls, 'description': cls.description,
                    'input_parameters': cls.input_parameters, 'output_parameters': cls.output_parameters}
            if getattr(cls, 'database_name', None) in self.init_databases:
                info['init_database'] = self.init_databases[cls.database_name]
            self.apis.append(info)
        self.token_checker = self.init_tool('CheckToken')

    def get_api_by_name(self, name: str):
        """
        Gets the API with the given name.

        Parameters:
        - name (str): the name of the API to get.

        Returns:
        - api (dict): the API with the given name.
        """
        for api in self.apis:
            if api['name'] == name:
                return api
        raise Exception('invalid tool name.')

    def get_api_description(self, name: str):
        """
        Gets the description of the API with the given name.

        Parameters:
        - name (str): the name of the API to get the description of.

        Returns:
        - desc (str): the description of the API with the given name.
        """
        api_info = self.get_api_by_name(name).copy()
        api_info.pop('class')
        if 'init_database' in api_info:
            api_info.pop('init_database')
        return json.dumps(api_info)

    def init_tool(self, tool_name: str, *args, **kwargs):
        """
        Initializes a tool with the given name and parameters.

        Parameters:
        - tool_name (str): the name of the tool to initialize.
        - args (list): the positional arguments to initialize the tool with.
        - kwargs (dict): the parameters to initialize the tool with.

        Returns:
        - tool (object): the initialized tool.
        """
        if tool_name in self.inited_tools:
            return self.inited_tools[tool_name]
        # Get the class for the tool
        api_class = self.get_api_by_name(tool_name)['class']
        temp_args = []

        if 'init_database' in self.get_api_by_name(tool_name):
            # Initialize the tool with the init database
            temp_args.append(self.get_api_by_name(tool_name)['init_database'])
        
        if tool_name != 'CheckToken' and 'token' in self.get_api_by_name(tool_name)['input_parameters']:
            temp_args.append(self.token_checker)

        args = temp_args + list(args)
        tool = api_class(*args, **kwargs)

        self.inited_tools[tool_name] = tool
        return tool

    def api_call(self, tool_name: str, **kwargs): 
        """
        Calls the API with the given name and parameters.
        """
        input_parameters = self.get_api_by_name(tool_name)['input_parameters'] # {'username': {'type': 'str', 'description': 'The username of the user.'}, 'password': {'type': 'str', 'description': 'The password of the user.'}}
        # assert len(kwargs) == len(input_parameters), 'invalid number of parameters. expected: {}, got: {}'.format(len(input_parameters), len(kwargs))

        processed_parameters = {}
        for input_key in kwargs:
            input_value = kwargs[input_key]
            assert input_key in input_parameters, 'invalid parameter name. parameter: {}'.format(input_key)
            required_para = input_parameters[input_key]

            required_type = required_para['type']
            if required_type == 'int':
                if isinstance(input_value, str):
                    assert input_value.isdigit(), 'invalid parameter type. parameter: {}'.format(input_value)
                processed_parameters[input_key] = int(input_value)
            elif required_type == 'float':
                if isinstance(input_value, str):
                    assert input_value.replace('.', '', 1).isdigit(), 'invalid parameter type.'
                processed_parameters[input_key] = float(input_value)
            elif required_type == 'str':
                processed_parameters[input_key] = input_value
            elif required_type == 'list(str)':
                # input_value = input_value.replace('\'', '"')
                processed_parameters[input_key] = input_value
            elif required_type == 'list':
                # input_value = input_value.replace('\'', '"')
                processed_parameters[input_key] = input_value
            elif required_type == 'bool':
                processed_parameters[input_key] = input_value == 'True'
            else:
                raise Exception('invalid parameter type.')
        
        tool = self.init_tool(tool_name)
        result = tool.call(**processed_parameters)
        return result

    def list_all_apis(self):
        """
        Lists all the APIs.

        Returns:
        - apis (list): a list of all the APIs.
        """
        return [api['name'] for api in self.apis]
